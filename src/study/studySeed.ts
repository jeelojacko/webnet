import { createInitialProgress, DEFAULT_STUDY_PHASE_RULES } from './studyScheduler';
import { createStudyFsrsConfigRecord } from './fsrs/studyFsrsMigration';
import type {
  StudyConcept,
  StudyDataSnapshot,
  StudyDocument,
  StudyPrompt,
  StudyRubricItem,
  StudySettings,
  StudyUnit,
} from './studyTypes';

const SEED_CREATED_AT = '2026-08-05T00:00:00.000Z';

const document = ({
  id,
  title,
  summary,
  priority,
}: {
  id: string;
  title: string;
  summary: string;
  priority: 1 | 2 | 3 | 4 | 5;
}): StudyDocument => ({
  id,
  title,
  kind: 'act',
  jurisdiction: 'New Brunswick',
  category: 'Statute law',
  priority,
  summary,
  sourceFiles: [],
  createdAt: SEED_CREATED_AT,
  updatedAt: SEED_CREATED_AT,
});

const documents: StudyDocument[] = [
  document({
    id: 'doc-surveys-act',
    title: 'Surveys Act',
    summary: 'Survey authority, plans, monuments, and professional obligations.',
    priority: 1,
  }),
  document({
    id: 'doc-boundaries-confirmation-act',
    title: 'Boundaries Confirmation Act',
    summary: 'Procedures and effects for confirming uncertain boundaries.',
    priority: 2,
  }),
  document({
    id: 'doc-community-planning-act',
    title: 'Community Planning Act',
    summary: 'Planning approvals, subdivision controls, and land-use administration.',
    priority: 2,
  }),
  document({
    id: 'doc-registry-act',
    title: 'Registry Act',
    summary: 'Registry recording concepts and search implications for land records.',
    priority: 3,
  }),
  document({
    id: 'doc-land-titles-act',
    title: 'Land Titles Act',
    summary: 'Land titles registration, parcels, instruments, and title certainty.',
    priority: 3,
  }),
];

const units: StudyUnit[] = [
  {
    id: 'unit-surveys-monuments',
    title: 'Survey monuments and statutory evidence',
    sourceMode: 'official',
    documentIds: ['doc-surveys-act'],
    sectionRefs: [{ documentId: 'doc-surveys-act', label: 'Monuments and plans' }],
    category: 'Survey law',
    priority: 1,
    editableSummary: 'Explain how monument evidence and plans interact before relying on measurements alone.',
    referenceAnswer:
      'A strong answer separates physical monument evidence, plan evidence, statutory authority, and professional judgment. It should explain that source wording stays authoritative while the study note is only the learner summary.',
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  },
  {
    id: 'unit-boundaries-confirmation-process',
    title: 'Boundary confirmation workflow',
    sourceMode: 'official',
    documentIds: ['doc-boundaries-confirmation-act'],
    sectionRefs: [{ documentId: 'doc-boundaries-confirmation-act', label: 'Application and effect' }],
    category: 'Boundary law',
    priority: 2,
    editableSummary: 'Track the steps, notice posture, and legal effect of confirming a boundary.',
    referenceAnswer:
      'A complete answer identifies the initiating problem, procedural safeguards, affected parties, evidence review, and the consequence of confirmation on later boundary reliance.',
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  },
  {
    id: 'unit-community-planning-subdivision',
    title: 'Subdivision approval constraints',
    sourceMode: 'official',
    documentIds: ['doc-community-planning-act'],
    sectionRefs: [{ documentId: 'doc-community-planning-act', label: 'Subdivision control' }],
    category: 'Planning law',
    priority: 2,
    editableSummary: 'Connect survey deliverables to planning approval and subdivision constraints.',
    referenceAnswer:
      'The answer should connect the land-use approval framework, subdivision conditions, public-interest constraints, and the surveyor role in creating reliable plan material for approval.',
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  },
  {
    id: 'unit-registry-search-priority',
    title: 'Registry records and priority risk',
    sourceMode: 'official',
    documentIds: ['doc-registry-act'],
    sectionRefs: [{ documentId: 'doc-registry-act', label: 'Registration and search' }],
    category: 'Title records',
    priority: 3,
    editableSummary: 'Summarize what registry records can and cannot prove for boundary work.',
    referenceAnswer:
      'A good answer distinguishes recorded instruments from ground evidence, notes the importance of search chronology, and avoids treating the registry record as a direct field boundary by itself.',
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  },
  {
    id: 'unit-land-titles-parcel',
    title: 'Land titles parcel certainty',
    sourceMode: 'official',
    documentIds: ['doc-land-titles-act'],
    sectionRefs: [{ documentId: 'doc-land-titles-act', label: 'Parcel and title registration' }],
    category: 'Title records',
    priority: 3,
    editableSummary: 'Explain how land titles registration changes the reliability question.',
    referenceAnswer:
      'The answer should describe title-registration certainty, parcel description reliance, instrument registration, and the need to keep source text separate from the learner interpretation.',
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  },
];

const conceptOrderByUnit = new Map<string, number>();
const concepts: StudyConcept[] = [
  ['concept-monument-evidence', 'unit-surveys-monuments', 'Physical monuments are evidence', true],
  ['concept-plan-evidence', 'unit-surveys-monuments', 'Plans and statutory source text stay separate', true],
  ['concept-boundary-notice', 'unit-boundaries-confirmation-process', 'Affected interests require process awareness', true],
  ['concept-boundary-effect', 'unit-boundaries-confirmation-process', 'Confirmation changes later reliance', true],
  ['concept-subdivision-conditions', 'unit-community-planning-subdivision', 'Subdivision approval can impose conditions', true],
  ['concept-surveyor-role', 'unit-community-planning-subdivision', 'Survey deliverables support approval review', true],
  ['concept-registry-chronology', 'unit-registry-search-priority', 'Search chronology matters', true],
  ['concept-record-not-boundary', 'unit-registry-search-priority', 'Recorded text is not physical boundary proof alone', true],
  ['concept-title-certainty', 'unit-land-titles-parcel', 'Title registration changes certainty posture', true],
  ['concept-parcel-description', 'unit-land-titles-parcel', 'Parcel descriptions require careful interpretation', true],
].map(([id, unitId, label, required]) => {
  const normalizedUnitId = String(unitId);
  const order = conceptOrderByUnit.get(normalizedUnitId) ?? 0;
  conceptOrderByUnit.set(normalizedUnitId, order + 1);
  return {
    id: String(id),
    unitId: normalizedUnitId,
    label: String(label),
    required: Boolean(required),
    origin: 'manual' as const,
    order,
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  };
});

const prompts: StudyPrompt[] = units.flatMap((unit) => [
  {
    id: `${unit.id}-guided`,
    unitId: unit.id,
    kind: 'guided-recall',
    question: `Explain the main rule or workflow for ${unit.title}.`,
    referenceAnswer: unit.referenceAnswer,
    conceptIds: concepts.filter((concept) => concept.unitId === unit.id).map((concept) => concept.id),
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  },
  {
    id: `${unit.id}-application`,
    unitId: unit.id,
    kind: 'scenario',
    question: `Apply ${unit.title} to a short professional boundary or title-review scenario.`,
    referenceAnswer: unit.referenceAnswer,
    conceptIds: concepts.filter((concept) => concept.unitId === unit.id).map((concept) => concept.id),
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT,
  },
]);

const rubrics: StudyRubricItem[] = concepts.map((concept): StudyRubricItem => ({
  id: `${concept.id}-rubric`,
  unitId: concept.unitId,
  category: 'custom',
  prompt: concept.label,
  referenceAnswer: concept.explanation ?? '',
  required: concept.required,
  origin: 'manual',
  order: concept.order,
  createdAt: SEED_CREATED_AT,
  updatedAt: SEED_CREATED_AT,
}));

export const createDefaultStudySettings = (updatedAt = SEED_CREATED_AT): StudySettings => ({
  id: 'default',
  schemaVersion: 5,
  phaseRules: DEFAULT_STUDY_PHASE_RULES,
  fsrsConfig: createStudyFsrsConfigRecord({ now: new Date(updatedAt), configVersion: 1 }),
  newUnitPriorityLimit: 5,
  includeMaintenanceReviews: true,
  updatedAt,
});

export const createSeedStudyData = (nowIso = SEED_CREATED_AT): StudyDataSnapshot => ({
  schemaVersion: 10,
  exportedAt: nowIso,
  documents: documents.map((entry) => ({ ...entry })),
  units: units.map((entry) => ({ ...entry })),
  prompts: prompts.map((entry) => ({ ...entry, conceptIds: entry.conceptIds.slice() })),
  concepts: concepts.map((entry) => ({ ...entry })),
  rubrics: rubrics.map((entry) => ({ ...entry })),
  progress: units.map((unit) => createInitialProgress(unit.id, nowIso)),
  attempts: [],
  drafts: [],
  settings: createDefaultStudySettings(nowIso),
  legalDocuments: [],
  legalComponents: [],
  importHistory: [],
  aiAuthoringRuns: [],
  aiStudyMapProposals: [],
  aiUnitProposals: [],
  examPrepUnitProgress: [],
  examPrepRecallProgress: [],
  examPrepAttempts: [],
  examPrepSettings: [],
  examPrepMockSessions: [],
});

export const createEmptyStudyData = (nowIso = new Date().toISOString()): StudyDataSnapshot => ({
  schemaVersion: 10,
  exportedAt: nowIso,
  documents: [],
  units: [],
  prompts: [],
  concepts: [],
  rubrics: [],
  progress: [],
  attempts: [],
  drafts: [],
  settings: createDefaultStudySettings(nowIso),
  legalDocuments: [],
  legalComponents: [],
  importHistory: [],
  aiAuthoringRuns: [],
  aiStudyMapProposals: [],
  aiUnitProposals: [],
  examPrepUnitProgress: [],
  examPrepRecallProgress: [],
  examPrepAttempts: [],
  examPrepSettings: [],
  examPrepMockSessions: [],
});
