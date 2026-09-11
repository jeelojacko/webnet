import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  defaultBundledOfficialBridge,
  hasExistingOfficialImports,
  previewBundledPackageText,
  type BundledOfficialBridge,
  type BundledOfficialPackageStatus,
} from './studyBundledOfficialContent';
import { parseOfficialContentPackage, type OfficialContentPreview } from './studyOfficialContent';
import type { StudyStorage } from './studyStorageTypes';
import type { StudyDataSnapshot } from './studyTypes';

export const useStudyBundledOfficialContent = ({
  data,
  storage,
  setData,
  setStatusMessage,
  bridge = defaultBundledOfficialBridge,
}: {
  data: StudyDataSnapshot | null;
  storage: StudyStorage;
  setData: Dispatch<SetStateAction<StudyDataSnapshot | null>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  bridge?: BundledOfficialBridge;
}) => {
  const [bundledStatus, setBundledStatus] = useState<BundledOfficialPackageStatus>({
    available: false,
  });
  const [bundledPackageId, setBundledPackageId] = useState<string | null>(null);
  const [bundledPreview, setBundledPreview] = useState<OfficialContentPreview | null>(null);
  const [bundledPreviewError, setBundledPreviewError] = useState<string | null>(null);
  const [bundledBusy, setBundledBusy] = useState(false);

  const hasData = data !== null;
  useEffect(() => {
    let cancelled = false;
    if (!hasData) return;
    void (async () => {
      const status = await bridge.getStatus();
      if (cancelled) return;
      setBundledStatus(status);
      if (!status.available) {
        setBundledPackageId(null);
        return;
      }
      try {
        const packageId = await bridge.readPackageId();
        if (!cancelled) setBundledPackageId(packageId);
      } catch {
        if (!cancelled) setBundledPackageId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, hasData]);

  const loadBundledPreview = useCallback(async () => {
    if (!data) return;
    setBundledBusy(true);
    setBundledPreviewError(null);
    try {
      const text = await bridge.readPackageText();
      setBundledPreview(previewBundledPackageText(text, data));
    } catch (error) {
      setBundledPreview(null);
      setBundledPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setBundledBusy(false);
    }
  }, [bridge, data]);

  const installWithMessage = useCallback(
    async (verb: 'installed' | 'updated') => {
      if (!data) return;
      setBundledBusy(true);
      try {
        const contentPackage = parseOfficialContentPackage(await bridge.readPackageText());
        const snapshot = await storage.importOfficialContentPackage(contentPackage);
        setData({ ...snapshot, legalComponents: [] });
        setBundledPreview(null);
        setBundledPreviewError(null);
        setStatusMessage(`Bundled official library ${verb}: ${contentPackage.id}.`);
      } catch (error) {
        setStatusMessage(
          `Bundled library ${verb} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setBundledBusy(false);
      }
    },
    [bridge, data, setData, setStatusMessage, storage],
  );

  // First-run install only: refuses when official imports already exist so
  // the bundled library can never overwrite them.
  const installBundledPackage = useCallback(() => {
    if (!data) return Promise.resolve();
    if (hasExistingOfficialImports(data)) {
      setStatusMessage('Bundled library install refused: official imports already exist.');
      return Promise.resolve();
    }
    return installWithMessage('installed');
  }, [data, installWithMessage, setStatusMessage]);

  // Explicit update only (Manage page, preview differs): the import core
  // merges non-destructively and records history — no auto migration.
  const installBundledUpdate = useCallback(
    () => installWithMessage('updated'),
    [installWithMessage],
  );

  const clearBundledPreview = useCallback(() => {
    setBundledPreview(null);
    setBundledPreviewError(null);
  }, []);

  return {
    bundledStatus,
    bundledPackageId,
    bundledPreview,
    bundledPreviewError,
    bundledBusy,
    bundledFirstRunAvailable:
      bundledStatus.available && data !== null && !hasExistingOfficialImports(data),
    loadBundledPreview,
    installBundledPackage,
    installBundledUpdate,
    clearBundledPreview,
  };
};
