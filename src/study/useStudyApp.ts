import { useCallback, useEffect, useMemo, useState } from 'react';
import { exportStudyData, parseStudyImport } from './studyExportImport';
import { buildSessionItems, markReadingComplete, updateProgressAfterAttempt } from './studyScheduler';
import { createStudyStorage } from './studyStorage';
import type {
  StudyAttempt,
  StudyDataSnapshot,
  StudyDocument,
  StudyDraft,
  StudyProgress,
  StudyRating,
  StudySessionItem,
  StudyUnit,
} from './studyTypes';

const ACTIVE_DRAFT_ID = 'active-session';

const createId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const replaceById = <T extends { id: string }>(items: T[], item: T): T[] => [
  ...items.filter((entry) => entry.id !== item.id),
  item,
];

const replaceProgress = (items: StudyProgress[], item: StudyProgress): StudyProgress[] => [
  ...items.filter((entry) => entry.unitId !== item.unitId),
  item,
];

export const useStudyApp = () => {
  const storage = useMemo(() => createStudyStorage(), []);
  const [data, setData] = useState<StudyDataSnapshot | null>(null);
  const [routePath, setRoutePath] = useState(() => window.location.pathname);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [coveredConceptIds, setCoveredConceptIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [importText, setImportText] = useState('');

  useEffect(() => {
    let cancelled = false;
    storage.loadAll().then((snapshot) => {
      if (cancelled) return;
      setData(snapshot);
      const draft = snapshot.drafts.find((entry) => entry.id === ACTIVE_DRAFT_ID);
      if (draft) setAnswer(draft.answer);
    });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  useEffect(() => {
    const handlePop = () => setRoutePath(window.location.pathname);
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setRoutePath(path);
  }, []);

  const sessionItems = useMemo<StudySessionItem[]>(() => {
    if (!data) return [];
    return buildSessionItems({
      units: data.units,
      prompts: data.prompts,
      concepts: data.concepts,
      progress: data.progress,
      nowIso: new Date().toISOString(),
      newPriorityLimit: data.settings.newUnitPriorityLimit,
      limit: 25,
    });
  }, [data]);

  const activeItem = sessionItems[activeItemIndex] ?? sessionItems[0] ?? null;

  useEffect(() => {
    if (!activeItem || !answer) return;
    const nowIso = new Date().toISOString();
    const draft: StudyDraft = {
      id: ACTIVE_DRAFT_ID,
      unitId: activeItem.unit.id,
      promptId: activeItem.prompt.id,
      answer,
      startedAt: data?.drafts.find((entry) => entry.id === ACTIVE_DRAFT_ID)?.startedAt ?? nowIso,
      updatedAt: nowIso,
    };
    const handle = window.setTimeout(() => {
      storage.saveDraft(draft);
      setData((current) =>
        current
          ? {
              ...current,
              drafts: replaceById(current.drafts, draft),
            }
          : current,
      );
    }, 250);
    return () => window.clearTimeout(handle);
  }, [activeItem, answer, data?.drafts, storage]);

  const selectDocument = useCallback(
    (documentId: string) => navigate(`/study/document/${encodeURIComponent(documentId)}`),
    [navigate],
  );

  const saveDocument = useCallback(
    async (document: StudyDocument) => {
      const updated = { ...document, updatedAt: new Date().toISOString() };
      await storage.saveDocument(updated);
      setData((current) =>
        current ? { ...current, documents: replaceById(current.documents, updated) } : current,
      );
    },
    [storage],
  );

  const saveUnit = useCallback(
    async (unit: StudyUnit) => {
      const updated = { ...unit, updatedAt: new Date().toISOString() };
      await storage.saveUnit(updated);
      setData((current) =>
        current ? { ...current, units: replaceById(current.units, updated) } : current,
      );
    },
    [storage],
  );

  const completeReading = useCallback(
    async (unitId: string) => {
      if (!data) return;
      const existing =
        data.progress.find((entry) => entry.unitId === unitId) ??
        activeItem?.progress;
      if (!existing) return;
      const progress = markReadingComplete(existing, new Date().toISOString());
      await storage.saveProgress(progress);
      setData({ ...data, progress: replaceProgress(data.progress, progress) });
    },
    [activeItem?.progress, data, storage],
  );

  const toggleConcept = useCallback((conceptId: string) => {
    setCoveredConceptIds((current) =>
      current.includes(conceptId)
        ? current.filter((entry) => entry !== conceptId)
        : [...current, conceptId].sort(),
    );
  }, []);

  const rateActiveItem = useCallback(
    async (rating: StudyRating) => {
      if (!data || !activeItem) return;
      const nowIso = new Date().toISOString();
      const attempt: StudyAttempt = {
        id: createId('attempt'),
        unitId: activeItem.unit.id,
        promptId: activeItem.prompt.id,
        phase: activeItem.progress.phase,
        answer,
        coveredConceptIds,
        rating,
        startedAt: data.drafts.find((entry) => entry.id === ACTIVE_DRAFT_ID)?.startedAt ?? nowIso,
        revealedAt: nowIso,
        completedAt: nowIso,
      };
      const progress = updateProgressAfterAttempt({
        progress: activeItem.progress,
        attempt,
        rules: data.settings.phaseRules,
      });
      await storage.saveAttempt(attempt);
      await storage.saveProgress(progress);
      await storage.clearDraft(ACTIVE_DRAFT_ID);
      setData({
        ...data,
        attempts: [...data.attempts, attempt],
        progress: replaceProgress(data.progress, progress),
        drafts: data.drafts.filter((entry) => entry.id !== ACTIVE_DRAFT_ID),
      });
      setAnswer('');
      setRevealed(false);
      setCoveredConceptIds([]);
      setActiveItemIndex((index) => Math.min(index + 1, Math.max(sessionItems.length - 1, 0)));
    },
    [activeItem, answer, coveredConceptIds, data, sessionItems.length, storage],
  );

  const exportText = useMemo(() => (data ? exportStudyData(data) : ''), [data]);

  const importData = useCallback(async () => {
    const snapshot = parseStudyImport(importText);
    await storage.replaceAll(snapshot);
    setData(snapshot);
    setStatusMessage('Study data imported.');
  }, [importText, storage]);

  return {
    data,
    routePath,
    navigate,
    sessionItems,
    activeItem,
    answer,
    setAnswer,
    revealed,
    setRevealed,
    coveredConceptIds,
    toggleConcept,
    rateActiveItem,
    completeReading,
    activeItemIndex,
    setActiveItemIndex,
    selectDocument,
    saveDocument,
    saveUnit,
    exportText,
    importText,
    setImportText,
    importData,
    statusMessage,
  };
};
