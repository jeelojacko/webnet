import type { NbLawContentPackage } from './content/nbLawTypes';
import type { OfficialContentPreview } from './studyOfficialContent';
import type {
  AiAuthoringRun,
  AiStoredUnitProposal,
  AiStudyMapProposal,
} from './ai/studyAiTypes';
import type {
  ExamPrepAttempt,
  ExamPrepRecallAttempt,
  ExamPrepRecallProgress,
  ExamPrepRecallProgressExpectation,
  ExamPrepSettings,
  ExamPrepUnitProgress,
} from './examPrep/examPrepTypes';
import type {
  ExamPrepMockSession,
  ExamPrepMockSessionExpectation,
} from './examPrep/mock/examPrepMockTypes';
import type {
  StudyAttempt,
  StudyConcept,
  StudyDataSnapshot,
  StudyDocument,
  StudyDraft,
  ImportedLegalComponent,
  StudyProgress,
  StudyPrompt,
  StudyRubricItem,
  StudySettings,
  StudyUnit,
} from './studyTypes';

export interface StudyStorage {
  loadAll: () => Promise<StudyDataSnapshot>;
  getLegalComponent: (
    _documentId: string,
    _sourceKey: string,
  ) => Promise<ImportedLegalComponent | null>;
  getLegalComponentsByDocument: (_documentId: string) => Promise<ImportedLegalComponent[]>;
  getLegalComponentsBySourceKeys: (
    _documentId: string,
    _sourceKeys: string[],
  ) => Promise<ImportedLegalComponent[]>;
  getLegalDocumentComponentSummary: (_documentId: string) => Promise<{
    documentId: string;
    componentCount: number;
    sectionCount: number;
    subsectionCount: number;
    scheduleCount: number;
    formCount: number;
    referenceOnlyFormCount: number;
  }>;
  getLegalComponentCount: (_documentId: string) => Promise<number>;
  previewOfficialContentPackage: (
    _contentPackage: NbLawContentPackage,
  ) => Promise<OfficialContentPreview>;
  saveDocument: (_document: StudyDocument) => Promise<void>;
  saveUnit: (_unit: StudyUnit) => Promise<void>;
  savePrompt: (_prompt: StudyPrompt) => Promise<void>;
  replaceUnitConcepts: (_unitId: string, _concepts: StudyConcept[]) => Promise<void>;
  replaceUnitRubrics: (_unitId: string, _rubrics: StudyRubricItem[]) => Promise<void>;
  saveProgress: (_progress: StudyProgress) => Promise<void>;
  saveAttempt: (_attempt: StudyAttempt) => Promise<void>;
  saveRatedAttempt: (_options: {
    attempt: StudyAttempt;
    progress: StudyProgress;
    draftId: string;
    expectedProgressUpdatedAt?: string;
  }) => Promise<void>;
  saveSchedulingUndo: (_options: {
    attempt: StudyAttempt;
    progress: StudyProgress;
    expectedProgressUpdatedAt?: string;
  }) => Promise<void>;
  saveAttemptProgress: (_options: {
    attempt: StudyAttempt;
    progress: StudyProgress;
    expectedProgressUpdatedAt?: string;
  }) => Promise<void>;
  saveDraft: (_draft: StudyDraft) => Promise<void>;
  clearDraft: (_draftId: string) => Promise<void>;
  deleteUnitCascade: (_unitId: string) => Promise<void>;
  saveSettings: (_settings: StudySettings) => Promise<void>;
  saveAiAuthoringRun: (_run: AiAuthoringRun) => Promise<void>;
  saveAiStudyMapProposal: (_proposal: AiStudyMapProposal) => Promise<void>;
  saveAiUnitProposal: (_proposal: AiStoredUnitProposal) => Promise<void>;
  saveExamPrepUnitProgress: (_record: ExamPrepUnitProgress) => Promise<void>;
  deleteExamPrepUnitProgress: (_recordId: string) => Promise<void>;
  saveExamPrepRecallRating: (_options: {
    attempt: ExamPrepRecallAttempt;
    progress: ExamPrepRecallProgress;
    expectation: ExamPrepRecallProgressExpectation;
  }) => Promise<void>;
  saveExamPrepAttempt: (_attempt: ExamPrepAttempt) => Promise<void>;
  saveExamPrepSettings: (_record: ExamPrepSettings) => Promise<void>;
  saveExamPrepMockSession: (_options: {
    session: ExamPrepMockSession;
    expectation: ExamPrepMockSessionExpectation;
  }) => Promise<void>;
  replaceAiAuthoringArtifacts: (_artifacts: {
    runs?: AiAuthoringRun[];
    mapProposals?: AiStudyMapProposal[];
    unitProposals?: AiStoredUnitProposal[];
  }) => Promise<void>;
  approveAiUnitProposal: (_options: {
    proposalId: string;
    sourceComponents: ImportedLegalComponent[];
  }) => Promise<StudyDataSnapshot>;
  replaceAll: (_snapshot: StudyDataSnapshot) => Promise<void>;
  importOfficialContentPackage: (
    _contentPackage: NbLawContentPackage,
  ) => Promise<StudyDataSnapshot>;
}
