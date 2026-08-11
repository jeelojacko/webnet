import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { normalizeConceptLabelKey } from './studyConceptGeneration';
import { generateStudyRubric } from './studyRubricGeneration';
import { createDefaultStudySettings } from './studySeed';
import { createInitialProgress, markReadingComplete } from './studyScheduler';
import { buildStudyQueue } from './studyQueue';
import { buildStudySessionCompletionSummary } from './studySessionSummary';
import { persistStudyPracticeAttempt } from './studyPracticePersistence';
import { createStudyStorage, STUDY_SCHEMA_VERSION } from './studyStorage';
import {
  getLatestEligibleSchedulingAttempt,
  replaceById,
  replaceProgress,
} from './studyStateUpdates';
import {
  buildRatedStudyAttempt,
  buildStudyRatingPreviews,
  buildUndoLatestSchedulingRating,
} from './studyReviewTransaction';
import type {
  StudyAttempt,
  StudyDataSnapshot,
  StudyDocument,
  StudyDraft,
  StudyConcept,
  StudyProgress,
  StudyPrompt,
  StudyRating,
  StudyResponseMode,
  StudyRubricCoverage,
  StudyRubricItem,
  StudySessionItem,
  StudyUnit,
  ImportedLegalComponent,
} from './studyTypes';

const ACTIVE_DRAFT_ID = 'active-session';

const createId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const useStudyApp = () => {
  const storage = useMemo(() => createStudyStorage(), []);
  const [data, setData] = useState<StudyDataSnapshot | null>(null);
  const [routePath, setRoutePath] = useState(() => window.location.pathname);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [guidedResponses, setGuidedResponses] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [ratingNowIso, setRatingNowIso] = useState<string | null>(null);
  const [coveredConceptIds, setCoveredConceptIds] = useState<string[]>([]);
  const [rubricCoverage, setRubricCoverage] = useState<StudyRubricCoverage[]>([]);
  const [ratingPending, setRatingPending] = useState(false);
  const [sessionAttemptIds, setSessionAttemptIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [importText, setImportText] = useState('');
  const [officialPackageText, setOfficialPackageText] = useState('');
  const [officialPackagePreview, setOfficialPackagePreview] =
    useState<OfficialContentPreview | null>(null);
  const ratingInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    storage.loadAll().then((snapshot) => {
      if (cancelled) return;
      setData(snapshot);
      const draft = snapshot.drafts.find((entry) => entry.id === ACTIVE_DRAFT_ID);
      if (draft) {
        setAnswer(draft.answer);
        setGuidedResponses(draft.guidedResponses ?? {});
      }
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
    setRoutePath(window.location.pathname);
  }, []);

  const saveSettings = useCallback(
    async (settings: StudyDataSnapshot['settings']) => {
      const updated = { ...settings, updatedAt: new Date().toISOString() };
      await storage.saveSettings(updated);
      setData((current) => (current ? { ...current, settings: updated } : current));
    },
    [storage],
  );

  const sessionItems = useMemo<StudySessionItem[]>(() => {
    if (!data) return [];
    return buildStudyQueue({
      units: data.units,
      prompts: data.prompts,
      concepts: data.concepts,
      rubrics: data.rubrics,
      progress: data.progress,
      now: new Date(),
      newUnitsPerSession: data.settings.fsrsConfig?.userSettings.newUnitsPerSession ?? 5,
      limit: 25,
    });
  }, [data]);

  const activeItem = sessionItems[activeItemIndex] ?? null;
  const sessionAttempts = useMemo(
    () =>
      data?.attempts.filter(
        (attempt) =>
          sessionAttemptIds.includes(attempt.id) &&
          attempt.scheduling?.schedulingApplied === true &&
          !attempt.scheduling.undoneAt,
      ) ?? [],
    [data?.attempts, sessionAttemptIds],
  );
  const sessionCompletionSummary = useMemo(() => {
    if (!data || activeItem || sessionAttempts.length === 0) return null;
    return buildStudySessionCompletionSummary({
      attempts: sessionAttempts,
      remainingItems: sessionItems,
      now: new Date(),
    });
  }, [activeItem, data, sessionAttempts, sessionItems]);
  const responseMode: StudyResponseMode = useMemo(() => {
    const phase = activeItem?.progress.phase;
    if (activeItem?.unit.responseModeOverride) return activeItem.unit.responseModeOverride;
    if (phase === 'guided-recall') return 'guided';
    return 'free-recall';
  }, [activeItem]);

  const setSessionRevealed = useCallback((nextRevealed: boolean) => {
    setRevealed(nextRevealed);
    setRatingNowIso(nextRevealed ? new Date().toISOString() : null);
  }, []);

  const ratingPreviews = useMemo(() => {
    if (!data || !activeItem || !revealed || !ratingNowIso) return [];
    return buildStudyRatingPreviews({
      data,
      item: activeItem,
      now: new Date(ratingNowIso),
    });
  }, [activeItem, data, ratingNowIso, revealed]);

  useEffect(() => {
    const hasDraftAnswer =
      Boolean(answer) || Object.values(guidedResponses).some((value) => value.trim());
    if (!activeItem || !hasDraftAnswer) return;
    const nowIso = new Date().toISOString();
    const draft: StudyDraft = {
      id: ACTIVE_DRAFT_ID,
      unitId: activeItem.unit.id,
      promptId: activeItem.prompt.id,
      answer,
      responseMode,
      guidedResponses,
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
  }, [activeItem, answer, data?.drafts, guidedResponses, responseMode, storage]);

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
    async ({
      unit,
      prompt,
      concepts,
      rubrics,
    }: {
      unit: StudyUnit;
      prompt: StudyPrompt;
      concepts: StudyConcept[];
      rubrics: StudyRubricItem[];
    }) => {
      const nowIso = new Date().toISOString();
      const updatedUnit = { ...unit, updatedAt: nowIso };
      const updatedPrompt = {
        ...prompt,
        referenceAnswer: updatedUnit.referenceAnswer,
        updatedAt: nowIso,
      };
      const updatedConcepts = concepts.map((concept) => ({ ...concept, updatedAt: nowIso }));
      const updatedRubrics = rubrics.map((rubric) => ({ ...rubric, updatedAt: nowIso }));
      await storage.saveUnit(updatedUnit);
      await storage.savePrompt(updatedPrompt);
      await storage.replaceUnitConcepts(updatedUnit.id, updatedConcepts);
      await storage.replaceUnitRubrics(updatedUnit.id, updatedRubrics);
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
              rubrics: [
                ...current.rubrics.filter((rubric) => rubric.unitId !== updatedUnit.id),
                ...updatedRubrics,
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
      const selectedKeys = new Set(
        unit.sourceReferences.map((reference) => `${reference.documentId}::${reference.sourceKey}`),
      );
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
        title: unit.title ? ('user-edited' as const) : ('empty' as const),
        question: 'empty' as const,
        referenceAnswer: unit.referenceAnswer ? ('user-edited' as const) : ('empty' as const),
        editableSummary: unit.editableSummary ? ('user-edited' as const) : ('empty' as const),
        concepts: data.concepts.some((concept) => concept.unitId === unit.id)
          ? ('user-edited' as const)
          : ('empty' as const),
        rubrics: data.rubrics.some((rubric) => rubric.unitId === unit.id)
          ? ('user-edited' as const)
          : ('empty' as const),
      };
      const title = unit.title.trim()
        ? unit.title
        : generateStudyTitle({ documentTitle, selectedSources: sourceComponents });
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
          ? generateSourceCitationSummary({
              document: legalDocument,
              selectedSources: sourceComponents,
            })
          : unit.sourceCitationSummary,
        generatedContentState: {
          ...currentState,
          title: unit.title.trim() ? currentState.title : 'generated',
          referenceAnswer: unit.referenceAnswer.trim()
            ? currentState.referenceAnswer
            : referenceAnswer
              ? 'generated'
              : 'empty',
        },
        updatedAt: nowIso,
      };
      const existingRubrics = data.rubrics.filter((rubric) => rubric.unitId === unit.id);
      const generatedRubrics = generateStudyRubric({
        document: legalDocument,
        selectedSources: sourceComponents,
        unitType: unit.unitType ?? 'section',
      });
      const existingPrompt =
        data.prompts.find((entry) => entry.unitId === unit.id && entry.kind === 'guided-recall') ??
        data.prompts.find((entry) => entry.unitId === unit.id);
      const generatedQuestion = generateStudyQuestion({
        documentTitle,
        selectedSources: sourceComponents,
        rubricCategories: (existingRubrics.length ? existingRubrics : generatedRubrics).map(
          (rubric) => rubric.category,
        ),
      }).question;
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
        : suggestRequiredConcepts(sourceComponents).map(
            (label, index): StudyConcept => ({
              id: `${unit.id}-concept-${index + 1}`,
              unitId: unit.id,
              label,
              required: true,
              origin: 'generated',
              order: index,
              createdAt: nowIso,
              updatedAt: nowIso,
            }),
          );
      const rubrics = existingRubrics.length
        ? existingRubrics
        : generatedRubrics.map(
            (rubric, index): StudyRubricItem => ({
              ...rubric,
              id: `${unit.id}-rubric-${index + 1}`,
              unitId: unit.id,
              createdAt: nowIso,
              updatedAt: nowIso,
            }),
          );
      await storage.saveUnit(updatedUnit);
      await storage.savePrompt({ ...prompt, conceptIds: concepts.map((concept) => concept.id) });
      if (existingConcepts.length === 0) await storage.replaceUnitConcepts(unit.id, concepts);
      if (existingRubrics.length === 0) await storage.replaceUnitRubrics(unit.id, rubrics);
      setData({
        ...data,
        units: replaceById(data.units, updatedUnit),
        prompts: replaceById(data.prompts, {
          ...prompt,
          conceptIds: concepts.map((concept) => concept.id),
        }),
        concepts: existingConcepts.length ? data.concepts : [...data.concepts, ...concepts],
        rubrics: existingRubrics.length ? data.rubrics : [...data.rubrics, ...rubrics],
      });
      setStatusMessage(`Missing generated content filled for ${updatedUnit.title}.`);
    },
    [data, storage],
  );

  const completeReading = useCallback(
    async (unitId: string) => {
      if (!data) return;
      const existing =
        data.progress.find((entry) => entry.unitId === unitId) ?? activeItem?.progress;
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
      if (!data || !activeItem || ratingInFlightRef.current) return;
      if (activeItem.reason === 'source-review-required') {
        setStatusMessage('Review the changed source before rating this study unit.');
        return;
      }
      ratingInFlightRef.current = true;
      setRatingPending(true);
      const now = ratingNowIso ? new Date(ratingNowIso) : new Date();
      const { attempt, progress } = buildRatedStudyAttempt({
        data,
        item: activeItem,
        rating,
        now,
        attemptId: createId('attempt'),
        answer,
        responseMode,
        guidedResponses,
        coveredConceptIds,
        rubricCoverage,
        startedAt:
          data.drafts.find((entry) => entry.id === ACTIVE_DRAFT_ID)?.startedAt ?? now.toISOString(),
      });
      try {
        await storage.saveRatedAttempt({
          attempt,
          progress,
          draftId: ACTIVE_DRAFT_ID,
          expectedProgressUpdatedAt: activeItem.progress.updatedAt,
        });
        setData({
          ...data,
          attempts: [...data.attempts, attempt],
          progress: replaceProgress(data.progress, progress),
          drafts: data.drafts.filter((entry) => entry.id !== ACTIVE_DRAFT_ID),
        });
        setSessionAttemptIds((ids) => [...ids, attempt.id]);
        setAnswer('');
        setGuidedResponses({});
        setRevealed(false);
        setRatingNowIso(null);
        setCoveredConceptIds([]);
        setRubricCoverage([]);
        setActiveItemIndex(0);
      } finally {
        ratingInFlightRef.current = false;
        setRatingPending(false);
      }
    },
    [
      activeItem,
      answer,
      coveredConceptIds,
      data,
      guidedResponses,
      ratingNowIso,
      responseMode,
      rubricCoverage,
      storage,
    ],
  );

  const savePracticeAttempt = useCallback(
    async ({
      item,
      rating,
      reason,
      answer,
      responseMode,
      guidedResponses,
      coveredConceptIds,
      rubricCoverage,
      startedAt,
      revealedAt,
      countScheduling = false,
    }: {
      item: StudySessionItem;
      rating: StudyRating;
      reason: 'manual-practice' | 'surprise-practice';
      answer: string;
      responseMode: StudyResponseMode;
      guidedResponses: Record<string, string>;
      coveredConceptIds: string[];
      rubricCoverage: StudyRubricCoverage[];
      startedAt: string;
      revealedAt: string;
      countScheduling?: boolean;
    }) => {
      if (!data) return;
      const result = await persistStudyPracticeAttempt({
        data,
        storage,
        item,
        rating,
        reason,
        answer,
        responseMode,
        guidedResponses,
        coveredConceptIds,
        rubricCoverage,
        startedAt,
        revealedAt,
        countScheduling,
        attemptId: createId('attempt-practice'),
      });
      setData(result.snapshot);
      setStatusMessage(result.statusMessage);
    },
    [data, storage],
  );

  const undoLatestStudyRating = useCallback(async () => {
    if (!data) return;
    const latest = getLatestEligibleSchedulingAttempt(data.attempts);
    if (!latest) {
      setStatusMessage('No eligible Study rating is available to undo.');
      return;
    }
    const { attempt, progress } = buildUndoLatestSchedulingRating({
      data,
      attemptId: latest.id,
      now: new Date(),
    });
    await storage.saveSchedulingUndo({
      attempt,
      progress,
      expectedProgressUpdatedAt: data.progress.find((entry) => entry.unitId === progress.unitId)
        ?.updatedAt,
    });
    setData({
      ...data,
      attempts: replaceById(data.attempts, attempt),
      progress: replaceProgress(data.progress, progress),
    });
    setSessionAttemptIds((ids) => ids.filter((id) => id !== attempt.id));
    setActiveItemIndex(0);
    setStatusMessage('Latest Study rating undone.');
  }, [data, storage]);

  const exportText = useMemo(() => (data ? exportStudyData(data) : ''), [data]);

  const importData = useCallback(async () => {
    const snapshot = parseStudyImport(importText);
    await storage.replaceAll(snapshot);
    setData(snapshot);
    setStatusMessage('Study data imported.');
  }, [importText, storage]);

  const deleteAllData = useCallback(async () => {
    const nowIso = new Date().toISOString();
    const snapshot: StudyDataSnapshot = {
      schemaVersion: data?.schemaVersion ?? STUDY_SCHEMA_VERSION,
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
    };
    await storage.replaceAll(snapshot);
    setData(snapshot);
    setAnswer('');
    setGuidedResponses({});
    setRevealed(false);
    setRatingNowIso(null);
    setCoveredConceptIds([]);
    setRubricCoverage([]);
    setActiveItemIndex(0);
    setSessionAttemptIds([]);
    setImportText('');
    setOfficialPackageText('');
    setOfficialPackagePreview(null);
    setStatusMessage('All Study data deleted. Clean slate ready.');
    navigate('/study/manage');
  }, [data?.schemaVersion, navigate, storage]);

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
      const { unit, prompt, concepts, rubrics } = createStudyContentFromSourceSelection({
        document,
        legalDocument,
        components: selectedComponents,
        existingUnits: data.units,
      });
      await storage.saveUnit(unit);
      await storage.savePrompt(prompt);
      await storage.replaceUnitConcepts(unit.id, concepts);
      await storage.replaceUnitRubrics(unit.id, rubrics);
      const progress = createInitialProgress(unit.id, unit.createdAt);
      await storage.saveProgress(progress);
      setData({
        ...data,
        units: [...data.units, unit],
        prompts: [...data.prompts, prompt],
        concepts: [...data.concepts, ...concepts],
        rubrics: [...data.rubrics, ...rubrics],
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

  const createCustomUnit = useCallback(async () => {
    if (!data) return;
    const nowIso = new Date().toISOString();
    const unit: StudyUnit = {
      id: createId('unit-custom'),
      title: 'New custom study unit',
      sourceMode: 'custom',
      documentIds: [],
      sectionRefs: [],
      sourceReferences: [],
      category: '',
      priority: 3,
      promptKind: 'guided-recall',
      phase: 'unread',
      tags: [],
      editableSummary: '',
      referenceAnswer: '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const prompt: StudyPrompt = {
      id: `${unit.id}-guided`,
      unitId: unit.id,
      kind: 'guided-recall',
      question: '',
      referenceAnswer: '',
      conceptIds: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const progress = createInitialProgress(unit.id, nowIso);
    await storage.saveUnit(unit);
    await storage.savePrompt(prompt);
    await storage.saveProgress(progress);
    setData({
      ...data,
      units: [...data.units, unit],
      prompts: [...data.prompts, prompt],
      progress: [...data.progress, progress],
    });
    navigate(`/study/unit/${encodeURIComponent(unit.id)}/edit`, { returnTo: '/study/library' });
  }, [data, navigate, storage]);

  const deleteUnit = useCallback(
    async (unitId: string) => {
      if (!data || !window.confirm('Delete this study unit and its local study records?')) return;
      const next: StudyDataSnapshot = {
        ...data,
        units: data.units.filter((unit) => unit.id !== unitId),
        prompts: data.prompts.filter((prompt) => prompt.unitId !== unitId),
        concepts: data.concepts.filter((concept) => concept.unitId !== unitId),
        progress: data.progress.filter((progress) => progress.unitId !== unitId),
        attempts: data.attempts.filter((attempt) => attempt.unitId !== unitId),
        drafts: data.drafts.filter((draft) => draft.unitId !== unitId),
        rubrics: data.rubrics.filter((rubric) => rubric.unitId !== unitId),
      };
      await storage.replaceAll(next);
      setData(next);
      setStatusMessage('Study unit deleted.');
    },
    [data, storage],
  );

  const duplicateUnit = useCallback(
    async (unitId: string) => {
      if (!data) return;
      const source = data.units.find((unit) => unit.id === unitId);
      if (!source) return;
      const nowIso = new Date().toISOString();
      const duplicateId = createId(
        source.sourceMode === 'custom' ? 'unit-custom-copy' : 'unit-source-copy',
      );
      const unit: StudyUnit = {
        ...source,
        id: duplicateId,
        title: `${source.title} copy`,
        sourceReviewRequired: false,
        sourceReferenceMissing: false,
        sourceReviewAcknowledgedAt: undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const sourcePrompts = data.prompts.filter((prompt) => prompt.unitId === unitId);
      const sourceConcepts = data.concepts
        .filter((concept) => concept.unitId === unitId)
        .slice()
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
      const concepts = sourceConcepts.map(
        (concept, index): StudyConcept => ({
          ...concept,
          id: `${duplicateId}-concept-${index + 1}`,
          unitId: duplicateId,
          order: index,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      );
      const conceptIdByKey = new Map(
        sourceConcepts.map((concept, index) => [
          normalizeConceptLabelKey(concept.label),
          concepts[index].id,
        ]),
      );
      const prompts = sourcePrompts.map(
        (prompt, index): StudyPrompt => ({
          ...prompt,
          id: `${duplicateId}-${prompt.kind}-${index + 1}`,
          unitId: duplicateId,
          conceptIds: prompt.conceptIds
            .map((conceptId) => sourceConcepts.find((concept) => concept.id === conceptId))
            .map((concept) =>
              concept ? conceptIdByKey.get(normalizeConceptLabelKey(concept.label)) : undefined,
            )
            .filter((conceptId): conceptId is string => Boolean(conceptId)),
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      );
      const rubrics = data.rubrics
        .filter((rubric) => rubric.unitId === unitId)
        .slice()
        .sort((a, b) => a.order - b.order || a.prompt.localeCompare(b.prompt))
        .map(
          (rubric, index): StudyRubricItem => ({
            ...rubric,
            id: `${duplicateId}-rubric-${index + 1}`,
            unitId: duplicateId,
            order: index,
            createdAt: nowIso,
            updatedAt: nowIso,
          }),
        );
      const progress = createInitialProgress(duplicateId, nowIso);
      const next: StudyDataSnapshot = {
        ...data,
        units: [...data.units, unit],
        prompts: [...data.prompts, ...prompts],
        concepts: [...data.concepts, ...concepts],
        rubrics: [...data.rubrics, ...rubrics],
        progress: [...data.progress, progress],
      };
      await storage.replaceAll(next);
      setData(next);
      setStatusMessage(`Study unit duplicated: ${unit.title}.`);
      navigate(`/study/unit/${encodeURIComponent(unit.id)}/edit`, { returnTo: '/study/library' });
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
      setStatusMessage(`Source review acknowledged: ${updated.title}.`);
      return updated;
    },
    [data, storage],
  );

  return {
    data,
    routePath,
    navigate,
    sessionItems,
    activeItem,
    sessionCompletionSummary,
    answer,
    setAnswer,
    guidedResponses,
    setGuidedResponses,
    responseMode,
    revealed,
    setRevealed: setSessionRevealed,
    coveredConceptIds,
    toggleConcept,
    rubricCoverage,
    setRubricCoverage,
    ratingPreviews,
    ratingPending,
    rateActiveItem,
    undoLatestStudyRating,
    savePracticeAttempt,
    completeReading,
    activeItemIndex,
    setActiveItemIndex,
    selectDocument,
    saveDocument,
    saveUnit,
    saveSettings,
    saveUnitAuthoring,
    generateMissingStudyContent,
    exportText,
    importText,
    setImportText,
    importData,
    deleteAllData,
    officialPackageText,
    setOfficialPackageText,
    officialPackagePreview,
    previewOfficialPackage,
    importOfficialPackage,
    createUnitFromSourceSelection,
    createCustomUnit,
    deleteUnit,
    duplicateUnit,
    acknowledgeSourceReview,
    statusMessage,
  };
};
