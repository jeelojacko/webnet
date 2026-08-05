import { useCallback, useEffect, useMemo, useState } from 'react';
import { exportStudyData, parseStudyImport } from './studyExportImport';
import type { NbLawContentPackage } from './content/nbLawTypes';
import {
  acknowledgeUnitSourceReview,
  createStudyContentFromSourceSelection,
  parseOfficialContentPackage,
  previewOfficialContentPackage,
  type OfficialContentPreview,
} from './studyOfficialContent';
import {
  DEFAULT_REFERENCE_ANSWER_OPTIONS,
  generateReferenceAnswer,
  generateSourceCitationSummary,
  generateStudyQuestion,
  generateStudyTitle,
  suggestRequiredConcepts,
} from './studyDraftGeneration';
import { buildSessionItems, markReadingComplete, updateProgressAfterAttempt } from './studyScheduler';
import { createStudyStorage } from './studyStorage';
import type {
  StudyAttempt,
  StudyDataSnapshot,
  StudyDocument,
  StudyDraft,
  StudyConcept,
  StudyProgress,
  StudyPrompt,
  StudyRating,
  StudySessionItem,
  StudyUnit,
  ImportedLegalComponent,
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
  const [officialPackageText, setOfficialPackageText] = useState('');
  const [officialPackagePreview, setOfficialPackagePreview] = useState<OfficialContentPreview | null>(null);

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

  const navigate = useCallback((path: string, state: unknown = null) => {
    window.history.pushState(state, '', path);
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

  const saveUnitAuthoring = useCallback(
    async ({ unit, prompt, concepts }: { unit: StudyUnit; prompt: StudyPrompt; concepts: StudyConcept[] }) => {
      const nowIso = new Date().toISOString();
      const updatedUnit = { ...unit, updatedAt: nowIso };
      const updatedPrompt = { ...prompt, referenceAnswer: updatedUnit.referenceAnswer, updatedAt: nowIso };
      const updatedConcepts = concepts.map((concept) => ({ ...concept, updatedAt: nowIso }));
      await storage.saveUnit(updatedUnit);
      await storage.savePrompt(updatedPrompt);
      await storage.replaceUnitConcepts(updatedUnit.id, updatedConcepts);
      setData((current) =>
        current
          ? {
              ...current,
              units: replaceById(current.units, updatedUnit),
              prompts: replaceById(current.prompts, updatedPrompt),
              concepts: [
                ...current.concepts.filter((concept) => concept.unitId !== updatedUnit.id),
                ...updatedConcepts,
              ],
            }
          : current,
      );
      setStatusMessage(`Study unit saved: ${updatedUnit.title}.`);
    },
    [storage],
  );

  const generateMissingStudyContent = useCallback(
    async (unitId: string) => {
      if (!data) return;
      const unit = data.units.find((entry) => entry.id === unitId);
      if (!unit?.sourceReferences?.length) return;
      const selectedKeys = new Set(unit.sourceReferences.map((reference) => `${reference.documentId}::${reference.sourceKey}`));
      const sourceComponents = data.legalComponents.filter((component) =>
        selectedKeys.has(`${component.documentId}::${component.sourceKey}`),
      );
      const documentId = unit.documentIds[0] ?? unit.sourceReferences[0]?.documentId;
      const studyDocument = data.documents.find((entry) => entry.id === documentId);
      const legalDocument = data.legalDocuments.find((entry) => entry.id === documentId);
      if (!studyDocument || sourceComponents.length === 0) return;
      const nowIso = new Date().toISOString();
      const documentTitle = legalDocument?.officialTitle ?? studyDocument.title;
      const currentState = unit.generatedContentState ?? {
        title: unit.title ? 'user-edited' as const : 'empty' as const,
        question: 'empty' as const,
        referenceAnswer: unit.referenceAnswer ? 'user-edited' as const : 'empty' as const,
        editableSummary: unit.editableSummary ? 'user-edited' as const : 'empty' as const,
        concepts: data.concepts.some((concept) => concept.unitId === unit.id) ? 'user-edited' as const : 'empty' as const,
      };
      const title = unit.title.trim() ? unit.title : generateStudyTitle({ documentTitle, selectedSources: sourceComponents });
      const referenceAnswer =
        unit.referenceAnswer.trim() || !legalDocument
          ? unit.referenceAnswer
          : generateReferenceAnswer({
              document: legalDocument,
              selectedSources: sourceComponents,
              options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
            }).text;
      const updatedUnit: StudyUnit = {
        ...unit,
        title,
        referenceAnswer,
        sourceCitationSummary: legalDocument
          ? generateSourceCitationSummary({ document: legalDocument, selectedSources: sourceComponents })
          : unit.sourceCitationSummary,
        generatedContentState: {
          ...currentState,
          title: unit.title.trim() ? currentState.title : 'generated',
          referenceAnswer: unit.referenceAnswer.trim() ? currentState.referenceAnswer : referenceAnswer ? 'generated' : 'empty',
        },
        updatedAt: nowIso,
      };
      const existingPrompt = data.prompts.find((entry) => entry.unitId === unit.id && entry.kind === 'guided-recall')
        ?? data.prompts.find((entry) => entry.unitId === unit.id);
      const generatedQuestion = generateStudyQuestion({ documentTitle, selectedSources: sourceComponents }).question;
      const prompt: StudyPrompt = existingPrompt
        ? {
            ...existingPrompt,
            question: existingPrompt.question.trim() ? existingPrompt.question : generatedQuestion,
            referenceAnswer,
            updatedAt: nowIso,
          }
        : {
            id: `${unit.id}-guided`,
            unitId: unit.id,
            kind: 'guided-recall',
            question: generatedQuestion,
            referenceAnswer,
            conceptIds: [],
            createdAt: nowIso,
            updatedAt: nowIso,
          };
      const existingConcepts = data.concepts.filter((concept) => concept.unitId === unit.id);
      const concepts = existingConcepts.length
        ? existingConcepts
        : suggestRequiredConcepts(sourceComponents).map((label, index): StudyConcept => ({
            id: `${unit.id}-concept-${index + 1}`,
            unitId: unit.id,
            label,
            required: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          }));
      await storage.saveUnit(updatedUnit);
      await storage.savePrompt({ ...prompt, conceptIds: concepts.map((concept) => concept.id) });
      if (existingConcepts.length === 0) await storage.replaceUnitConcepts(unit.id, concepts);
      setData({
        ...data,
        units: replaceById(data.units, updatedUnit),
        prompts: replaceById(data.prompts, { ...prompt, conceptIds: concepts.map((concept) => concept.id) }),
        concepts: existingConcepts.length ? data.concepts : [...data.concepts, ...concepts],
      });
      setStatusMessage(`Missing generated content filled for ${updatedUnit.title}.`);
    },
    [data, storage],
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

  const previewOfficialPackage = useCallback(() => {
    if (!data) return;
    try {
      const contentPackage = parseOfficialContentPackage(officialPackageText);
      setOfficialPackagePreview(previewOfficialContentPackage(data, contentPackage));
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
  }, [data, officialPackageText]);

  const importOfficialPackage = useCallback(async () => {
    const contentPackage: NbLawContentPackage = parseOfficialContentPackage(officialPackageText);
    const snapshot = await storage.importOfficialContentPackage(contentPackage);
    setData(snapshot);
    setOfficialPackagePreview(previewOfficialContentPackage(snapshot, contentPackage));
    setStatusMessage(`Official content package imported: ${contentPackage.id}.`);
  }, [officialPackageText, storage]);

  const createUnitFromSourceSelection = useCallback(
    async (documentId: string, selectedComponents: ImportedLegalComponent[]) => {
      if (!data) return;
      const document = data.documents.find((entry) => entry.id === documentId);
      const legalDocument = data.legalDocuments.find((entry) => entry.id === documentId);
      if (!document || selectedComponents.length === 0) return;
      const { unit, prompt, concepts } = createStudyContentFromSourceSelection({
        document,
        legalDocument,
        components: selectedComponents,
        existingUnits: data.units,
      });
      await storage.saveUnit(unit);
      await storage.savePrompt(prompt);
      await storage.replaceUnitConcepts(unit.id, concepts);
      const progress = {
        unitId: unit.id,
        phase: 'unread' as const,
        dueAt: unit.createdAt,
        lastStudiedAt: null,
        successfulGuidedRecallDays: [],
        successfulFreeRecallDays: [],
        applicationSuccessCount: 0,
        reviewCount: 0,
        createdAt: unit.createdAt,
        updatedAt: unit.createdAt,
      };
      await storage.saveProgress(progress);
      setData({
        ...data,
        units: [...data.units, unit],
        prompts: [...data.prompts, prompt],
        concepts: [...data.concepts, ...concepts],
        progress: [...data.progress, progress],
      });
      setStatusMessage(`Study unit created: ${unit.title}.`);
      navigate(`/study/unit/${encodeURIComponent(unit.id)}/edit`, {
        returnTo: `/study/document/${encodeURIComponent(documentId)}`,
        sourceKeys: selectedComponents.map((component) => component.sourceKey),
      });
    },
    [data, navigate, storage],
  );

  const acknowledgeSourceReview = useCallback(
    async (unitId: string) => {
      if (!data) return;
      const unit = data.units.find((entry) => entry.id === unitId);
      if (!unit) return;
      const updated = acknowledgeUnitSourceReview(unit, data.legalComponents);
      await storage.saveUnit(updated);
      setData({ ...data, units: replaceById(data.units, updated) });
    },
    [data, storage],
  );

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
    saveUnitAuthoring,
    generateMissingStudyContent,
    exportText,
    importText,
    setImportText,
    importData,
    officialPackageText,
    setOfficialPackageText,
    officialPackagePreview,
    previewOfficialPackage,
    importOfficialPackage,
    createUnitFromSourceSelection,
    acknowledgeSourceReview,
    statusMessage,
  };
};
