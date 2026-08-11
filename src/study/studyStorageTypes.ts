import type { NbLawContentPackage } from './content/nbLawTypes';
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
  replaceAll: (_snapshot: StudyDataSnapshot) => Promise<void>;
  importOfficialContentPackage: (
    _contentPackage: NbLawContentPackage,
  ) => Promise<StudyDataSnapshot>;
}
