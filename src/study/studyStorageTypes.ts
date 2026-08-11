import type { NbLawContentPackage } from './content/nbLawTypes';
import type {
  StudyAttempt,
  StudyConcept,
  StudyDataSnapshot,
  StudyDocument,
  StudyDraft,
  StudyProgress,
  StudyPrompt,
  StudyRubricItem,
  StudySettings,
  StudyUnit,
} from './studyTypes';

export interface StudyStorage {
  loadAll: () => Promise<StudyDataSnapshot>;
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
  saveSettings: (_settings: StudySettings) => Promise<void>;
  replaceAll: (_snapshot: StudyDataSnapshot) => Promise<void>;
  importOfficialContentPackage: (
    _contentPackage: NbLawContentPackage,
  ) => Promise<StudyDataSnapshot>;
}
