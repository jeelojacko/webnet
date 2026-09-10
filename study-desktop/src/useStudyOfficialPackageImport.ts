import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { NbLawContentPackage } from './content/nbLawTypes';
import {
  parseOfficialContentPackage,
  type OfficialContentPreview,
} from './studyOfficialContent';
import type { StudyStorage } from './studyStorageTypes';
import type { StudyDataSnapshot } from './studyTypes';

export const useStudyOfficialPackageImport = ({
  data,
  storage,
  setData,
  setStatusMessage,
}: {
  data: StudyDataSnapshot | null;
  storage: StudyStorage;
  setData: Dispatch<SetStateAction<StudyDataSnapshot | null>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
}) => {
  const [officialPackageText, setOfficialPackageText] = useState('');
  const [officialPackagePreview, setOfficialPackagePreview] =
    useState<OfficialContentPreview | null>(null);

  const previewOfficialPackage = useCallback(() => {
    if (!data) return;
    void (async () => {
      try {
        const contentPackage = parseOfficialContentPackage(officialPackageText);
        setOfficialPackagePreview(await storage.previewOfficialContentPackage(contentPackage));
      } catch (error) {
        setOfficialPackagePreview({
          valid: false,
          errors: [error instanceof Error ? error.message : String(error)],
          newDocuments: [],
          updatedDocuments: [],
          unchangedDocuments: [],
          absentExistingDocuments: [],
          newComponents: [],
          changedComponents: [],
          removedComponents: [],
          unchangedComponents: [],
          referenceOnlyForms: [],
          unitsRequiringSourceReview: [],
        });
      }
    })();
  }, [data, officialPackageText, storage]);

  const importOfficialPackage = useCallback(async () => {
    const contentPackage: NbLawContentPackage = parseOfficialContentPackage(officialPackageText);
    const snapshot = await storage.importOfficialContentPackage(contentPackage);
    setData({ ...snapshot, legalComponents: [] });
    setOfficialPackageText('');
    setOfficialPackagePreview(null);
    setStatusMessage(`Official content package imported: ${contentPackage.id}.`);
  }, [officialPackageText, setData, setStatusMessage, storage]);

  const clearOfficialPackageImport = useCallback(() => {
    setOfficialPackageText('');
    setOfficialPackagePreview(null);
  }, []);

  return {
    officialPackageText,
    setOfficialPackageText,
    officialPackagePreview,
    previewOfficialPackage,
    importOfficialPackage,
    clearOfficialPackageImport,
  };
};
