import { migrateStudySnapshot, STUDY_SCHEMA_VERSION } from './studyStorage';
import type { StudyDataSnapshot } from './studyTypes';

export const exportStudyData = (snapshot: StudyDataSnapshot, exportedAt = new Date().toISOString()): string =>
  JSON.stringify(
    {
      ...snapshot,
      schemaVersion: STUDY_SCHEMA_VERSION,
      exportedAt,
    },
    null,
    2,
  );

export const parseStudyImport = (text: string): StudyDataSnapshot => {
  const parsed = JSON.parse(text) as Partial<StudyDataSnapshot>;
  return migrateStudySnapshot(parsed);
};
